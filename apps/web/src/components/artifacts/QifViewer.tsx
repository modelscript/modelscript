// SPDX-License-Identifier: AGPL-3.0-or-later

import { renderQifMbdHeatmapSvg, renderQifSpcChartSvg } from "@modelscript/diagram/qif-diagram-builder";
import { parseQif } from "@modelscript/qif/parser";
import {
  buildQif3dMbdScene,
  type Qif3dCalloutAnchor,
  type Qif3dMbdScene,
  type Qif3dMeshPayload,
} from "@modelscript/qif/step-bridge";
import type { QifDocument } from "@modelscript/qif/types";
import {
  CheckIcon,
  ChecklistIcon,
  CodeIcon,
  CopyIcon,
  DownloadIcon,
  GraphIcon,
  StackIcon,
} from "@primer/octicons-react";
import { Button, Text } from "@primer/react";
import { Environment, Html, Line } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import DOMPurify from "dompurify";
import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as THREE from "three";
import { useTheme } from "../../theme";
import { buildEditorUrlForArtifact } from "../../util/editor-routing";
import Box from "../Box";
import AutoThumbnailCapture from "./AutoThumbnailCapture";
import { CompactTabStrip, FooterTabs, useHasFooterSlot } from "./card/CardFooterSlot";
import { adaptSvgMarkupForTheme, highlightPolyglotLine } from "./PolyglotArtifactViewer";
import { isSynthesizedStep, unionBounds } from "./qif-step-geometry";
import SafeOrbitControls from "./SafeOrbitControls";
import { useQifGeometry } from "./useQifGeometry";
import ViewportCameraControls, { type CameraPreset, type ClipAxis, type RenderMode } from "./ViewportCameraControls";

export interface QifViewerProps {
  artifactId?: string | number | undefined;
  viewConfig?: Record<string, unknown> | null | undefined;
  isFullScreen?: boolean | undefined;
}

export type QifViewTab = "3d" | "boc" | "spc" | "code";

function formatMaterialModifier(mod?: "RFS" | "MMC" | "LMC"): string {
  if (mod === "MMC") return "Ⓜ";
  if (mod === "LMC") return "Ⓛ";
  return "";
}

function getStatusHexColor(status: string, ratio = 0): string {
  if (status === "FAIL" || ratio > 1.0) return "#ef4444";
  if (status === "REWORK" || status === "MARGINAL" || ratio > 0.75) return "#f59e0b";
  return "#22c55e";
}

interface OrbitControlsHandle {
  target: { set: (x: number, y: number, z: number) => void };
  update: () => void;
}

function CameraController({
  controlsRef,
  presetTrigger,
}: {
  controlsRef: React.RefObject<OrbitControlsHandle | null>;
  presetTrigger: { preset: CameraPreset; timestamp: number } | null;
}) {
  const { camera } = useThree();
  useEffect(() => {
    camera.up.set(0, 0, 1);
  }, [camera]);

  useEffect(() => {
    if (!presetTrigger) return;
    const dist = 48;
    camera.up.set(0, 0, 1);
    switch (presetTrigger.preset) {
      case "front":
        camera.position.set(0, -dist, 8);
        break;
      case "top":
        camera.position.set(0, -0.01, dist);
        break;
      case "right":
        camera.position.set(dist, 0, 8);
        break;
      case "iso":
      case "reset":
      default:
        camera.position.set(36, -38, 28);
        break;
    }
    camera.lookAt(0, 0, 0);
    if (controlsRef.current) {
      controlsRef.current.target.set(0, 0, 0);
      controlsRef.current.update();
    }
  }, [presetTrigger, camera, controlsRef]);
  return null;
}

function QifFeatureMesh({
  payload,
  isSelected,
  showHeatmap,
  renderMode,
  clippingPlanes,
  onSelectFeature,
}: {
  payload: Qif3dMeshPayload;
  isSelected: boolean;
  showHeatmap: boolean;
  renderMode: RenderMode;
  clippingPlanes: THREE.Plane[];
  onSelectFeature: (featureId: string | undefined) => void;
}) {
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(payload.vertices, 3));
    if (payload.normals.length > 0) {
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(payload.normals, 3));
    } else {
      geo.computeVertexNormals();
    }
    if (payload.indices.length > 0) {
      geo.setIndex(new THREE.Uint32BufferAttribute(payload.indices, 1));
    }
    geo.computeBoundingSphere();
    return geo;
  }, [payload]);

  const color = useMemo(() => {
    if (isSelected) return new THREE.Color("#38bdf8");
    if (payload.isBodyEnvelope) return new THREE.Color("#334155");
    if (showHeatmap) {
      return new THREE.Color(payload.color[0], payload.color[1], payload.color[2]);
    }
    return new THREE.Color("#64748b");
  }, [isSelected, payload, showHeatmap]);

  const opacity = useMemo(() => {
    if (renderMode === "xray") return 0.32;
    if (payload.isBodyEnvelope) return 0.72;
    return 0.96;
  }, [renderMode, payload.isBodyEnvelope]);

  return (
    <mesh
      geometry={geometry}
      onClick={(e) => {
        e.stopPropagation();
        if (payload.featureId) {
          onSelectFeature(payload.featureId);
        }
      }}
    >
      <meshPhysicalMaterial
        color={color}
        metalness={payload.isBodyEnvelope ? 0.35 : 0.22}
        roughness={payload.isBodyEnvelope ? 0.45 : 0.32}
        emissive={isSelected ? new THREE.Color("#0284c7") : new THREE.Color("#000000")}
        emissiveIntensity={isSelected ? 0.35 : 0}
        wireframe={renderMode === "wireframe"}
        transparent={opacity < 1.0}
        opacity={opacity}
        clearcoat={0.15}
        side={THREE.DoubleSide}
        clippingPlanes={clippingPlanes}
        clipShadows={true}
      />
    </mesh>
  );
}

const QifViewerInner: React.FC<QifViewerProps> = ({ artifactId, viewConfig, isFullScreen = false }) => {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const navigate = useNavigate();

  const hasFooter = useHasFooterSlot();
  const [viewTab, setViewTab] = useState<QifViewTab>("3d");
  const [sourceSubTab, setSourceSubTab] = useState<"qif" | "step">("qif");
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);
  const [selectedCharId, setSelectedCharId] = useState<string | null>(null);
  const [showHeatmap, setShowHeatmap] = useState<boolean>(true);
  const [showProbes, setShowProbes] = useState<boolean>(false);
  const [show3dLabels, setShow3dLabels] = useState<boolean>(true);
  const [renderMode, setRenderMode] = useState<RenderMode>("shaded");
  const [clipAxis, setClipAxis] = useState<ClipAxis>("none");
  const [clipOffset, setClipOffset] = useState<number>(0);
  const [presetTrigger, setPresetTrigger] = useState<{
    preset: CameraPreset;
    timestamp: number;
  } | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const controlsRef = useRef<OrbitControlsHandle | null>(null);

  const rawQifText: string = useMemo(() => {
    const cfg = (viewConfig && typeof viewConfig === "object" ? viewConfig : {}) as Record<string, unknown>;
    const candidate = cfg["code"] || cfg["qifCode"] || cfg["source"] || cfg["content"] || "";
    return typeof candidate === "string" ? candidate : "";
  }, [viewConfig]);

  const externalStepText: string | undefined = useMemo(() => {
    const candidate = viewConfig?.stepCode || viewConfig?.stepSource;
    return typeof candidate === "string" && candidate.trim().length > 0 && !isSynthesizedStep(candidate)
      ? candidate
      : undefined;
  }, [viewConfig]);

  const geometryState = useQifGeometry(viewConfig, externalStepText);
  const pairedStepText = geometryState.status === "ready" ? geometryState.stepText : undefined;

  const baseParsedData = useMemo((): {
    doc: QifDocument;
    scene: Qif3dMbdScene;
    rawSpcSvg: string;
    rawHeatmapSvg: string;
  } => {
    const doc: QifDocument = parseQif(rawQifText);
    const scene = buildQif3dMbdScene(doc, pairedStepText);
    const rawSpcSvg = DOMPurify.sanitize(renderQifSpcChartSvg(scene.spcSummary));
    const rawHeatmapSvg = DOMPurify.sanitize(renderQifMbdHeatmapSvg(doc, scene.spcSummary));
    return {
      doc,
      scene,
      rawSpcSvg,
      rawHeatmapSvg,
    };
  }, [rawQifText, pairedStepText]);

  const spcSvg = useMemo(
    () => adaptSvgMarkupForTheme(baseParsedData.rawSpcSvg, isDark),
    [baseParsedData.rawSpcSvg, isDark],
  );
  const heatmapSvg = useMemo(
    () => adaptSvgMarkupForTheme(baseParsedData.rawHeatmapSvg, isDark),
    [baseParsedData.rawHeatmapSvg, isDark],
  );

  const { doc, scene: sceneBase } = baseParsedData;
  const partGeometry = geometryState.status === "ready" ? geometryState.geometry : null;
  const scene = useMemo(
    () =>
      partGeometry
        ? {
            ...sceneBase,
            meshes: [partGeometry.payload, ...sceneBase.meshes],
            boundingBox: unionBounds(sceneBase.boundingBox, partGeometry.bounds),
          }
        : sceneBase,
    [sceneBase, partGeometry],
  );

  const geometryTitle = geometryState.status !== "none" ? geometryState.title : undefined;
  const geometryNotice =
    geometryState.status === "none"
      ? "No 3D model attached"
      : geometryState.status === "loading"
        ? "Loading 3D model…"
        : geometryState.status === "error"
          ? "3D model unavailable"
          : geometryState.geometry
            ? `Model: ${geometryTitle ?? "STEP part"}`
            : "STEP has no displayable surfaces";
  const geometryNoticeDetail =
    geometryState.status === "error"
      ? geometryState.message
      : geometryState.status === "none"
        ? "No STEP model is paired with this inspection report. Showing GD&T features and measurements only."
        : (geometryTitle ?? "");

  const activeClippingPlanes = useMemo(() => {
    if (clipAxis === "none") return [];
    const span = 24;
    const d = clipOffset * span;
    if (clipAxis === "x") return [new THREE.Plane(new THREE.Vector3(-1, 0, 0), d)];
    if (clipAxis === "y") return [new THREE.Plane(new THREE.Vector3(0, -1, 0), d)];
    return [new THREE.Plane(new THREE.Vector3(0, 0, -1), d)];
  }, [clipAxis, clipOffset]);

  const sceneScale = useMemo(() => {
    return scene.boundingBox.radius > 0 ? 17 / scene.boundingBox.radius : 0.42;
  }, [scene.boundingBox.radius]);

  const sceneCenter = scene.boundingBox.center;

  const configTitle = [viewConfig?.title, viewConfig?.filename].find(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
  const title: string = configTitle || doc.header.partName || "QIF Inspection.qif";

  const activeCallout = useMemo(() => {
    if (selectedCharId) {
      return scene.callouts.find((c) => c.characteristicId === selectedCharId) ?? null;
    }
    if (selectedFeatureId) {
      return scene.callouts.find((c) => c.featureId === selectedFeatureId) ?? null;
    }
    return null;
  }, [scene.callouts, selectedCharId, selectedFeatureId]);

  const handleSelectCallout = (callout: Qif3dCalloutAnchor) => {
    setSelectedCharId((prev) => (prev === callout.characteristicId ? null : callout.characteristicId));
    setSelectedFeatureId((prev) =>
      selectedCharId === callout.characteristicId && prev === callout.featureId ? null : callout.featureId,
    );
  };

  const handleCopySource = async () => {
    const textToCopy = sourceSubTab === "qif" ? rawQifText : (pairedStepText ?? "");
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignore clipboard failure
    }
  };

  const handleDownloadQif = () => {
    const ext = sourceSubTab === "qif" ? ".qif" : ".step";
    const mime = sourceSubTab === "qif" ? "application/xml" : "application/step";
    const text = sourceSubTab === "qif" ? rawQifText : (pairedStepText ?? "");
    const blob = new Blob([text], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = title.replace(/\.(qif|step|stp)$/i, "") + ext;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleOpenInPlayground = () => {
    const targetUrl = buildEditorUrlForArtifact({
      artifactId: typeof artifactId === "number" ? artifactId : Number(viewConfig?.artifactId) || undefined,
      viewType: "qif",
      viewConfig,
      code: rawQifText,
      title,
      dialect: "qif",
    });
    navigate(targetUrl);
  };

  const activeSourceLines = useMemo(() => {
    const text = sourceSubTab === "qif" ? rawQifText : (pairedStepText ?? "");
    return text.split(/\r?\n/);
  }, [sourceSubTab, rawQifText, pairedStepText]);

  return (
    <Box
      data-testid="qif-viewer"
      position="relative"
      display="flex"
      flexDirection="column"
      width="100%"
      height={isFullScreen ? "100%" : "480px"}
      bg="var(--color-canvas-default, #0d1117)"
      overflow="hidden"
    >
      {hasFooter ? (
        <FooterTabs>
          <CompactTabStrip
            ariaLabel="QIF MBD Viewer Mode"
            active={viewTab}
            onChange={(id) => setViewTab(id as QifViewTab)}
            tabs={[
              { id: "3d", label: "3D + GD&T", icon: <StackIcon size={14} />, title: "3D CAD + GD&T" },
              {
                id: "boc",
                label: "BoC",
                icon: <ChecklistIcon size={14} />,
                count: doc.characteristics.length,
                title: "Bill of Characteristics",
              },
              { id: "spc", label: "SPC", icon: <GraphIcon size={14} />, title: "SPC & Heatmap" },
              { id: "code", label: "Code", icon: <CodeIcon size={14} />, title: "QIF XML source" },
            ]}
          />
        </FooterTabs>
      ) : (
        <>
          {/* Compact Single-Row Top Toolbar */}
          <Box
            height="44px"
            minHeight="44px"
            px={3}
            display="flex"
            alignItems="center"
            justifyContent="space-between"
            gap={2}
            borderBottom="1px solid var(--color-border-default, #30363d)"
            bg="var(--surface-hud, var(--color-canvas-subtle, #161b22))"
            zIndex={20}
          >
            <Box display="flex" alignItems="center" gap={2} minWidth={0}>
              {!isFullScreen && (
                <Text
                  style={{
                    fontSize: "13px",
                    fontWeight: 600,
                    color: "var(--color-fg-default, #e6edf3)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {title}
                </Text>
              )}
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 600,
                  padding: "2px 7px",
                  borderRadius: "999px",
                  background: "var(--domain-cad-bg, rgba(234, 88, 12, 0.12))",
                  color: "var(--domain-cad, #ea580c)",
                  border: "1px solid var(--domain-cad-border, rgba(234, 88, 12, 0.35))",
                  fontFamily: "var(--font-mono, monospace)",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                QIF 3.0 · STEP AP242
              </span>
            </Box>

            <Box display="flex" alignItems="center" gap={2} flexShrink={0}>
              <div
                role="tablist"
                aria-label="QIF MBD Viewer Mode"
                style={{
                  display: "inline-flex",
                  background: "var(--color-canvas-default, rgba(15, 23, 42, 0.75))",
                  border: "1px solid var(--color-border-default, #30363d)",
                  borderRadius: "6px",
                  padding: "2px",
                  gap: "2px",
                }}
              >
                {[
                  { id: "3d" as const, label: "3D CAD + GD&T" },
                  { id: "boc" as const, label: `BoC (${doc.characteristics.length})` },
                  { id: "spc" as const, label: "SPC & Heatmap" },
                  { id: "code" as const, label: "Code" },
                ].map((tab) => {
                  const active = viewTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setViewTab(tab.id)}
                      style={{
                        background: active ? "var(--ms-brand-soft, rgba(56, 189, 248, 0.2))" : "transparent",
                        color: active ? "var(--ms-brand, #38bdf8)" : "var(--color-fg-muted, #8b949e)",
                        border: active
                          ? "1px solid var(--ms-brand-border, rgba(56, 189, 248, 0.4))"
                          : "1px solid transparent",
                        borderRadius: "4px",
                        padding: "3px 9px",
                        fontSize: "11px",
                        fontWeight: 600,
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>
              {Boolean(viewConfig?.standalone) && (
                <Button size="small" variant="primary" leadingVisual={CodeIcon} onClick={handleOpenInPlayground}>
                  Open in Playground
                </Button>
              )}
            </Box>
          </Box>
        </>
      )}

      {/* Main Content Area */}
      <Box flex={1} position="relative" overflow="hidden" display="flex">
        {viewTab === "3d" && (
          <Box
            flex={1}
            position="relative"
            width="100%"
            height="100%"
            style={{
              background: isDark
                ? "radial-gradient(circle at 50% 48%, #1e293b 0%, #090d16 100%)"
                : "radial-gradient(circle at 50% 48%, #f8fafc 0%, #cbd5e1 100%)",
            }}
          >
            <ViewportCameraControls
              onPresetSelect={(preset) => setPresetTrigger({ preset, timestamp: Date.now() })}
              renderMode={renderMode}
              onRenderModeChange={setRenderMode}
              clipAxis={clipAxis}
              onClipAxisChange={setClipAxis}
              clipOffset={clipOffset}
              onClipOffsetChange={setClipOffset}
            />

            {/* Floating Selected ASME Y14.5 Callout / Feature Inspector Pill (only visible when a feature/pin is clicked) */}
            {activeCallout && (
              <Box
                position="absolute"
                top={12}
                right={12}
                zIndex={10}
                px={2}
                py={1}
                borderRadius="10px"
                bg="rgba(15, 23, 42, 0.88)"
                border={`1px solid ${getStatusHexColor(activeCallout.status, activeCallout.toleranceRatio)}`}
                display="flex"
                alignItems="center"
                gap={2}
                style={{
                  backdropFilter: "blur(10px)",
                  boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: "11px",
                  color: "#f8fafc",
                }}
              >
                <span
                  style={{
                    width: "16px",
                    height: "16px",
                    borderRadius: "50%",
                    background: getStatusHexColor(activeCallout.status, activeCallout.toleranceRatio),
                    color: "#0f172a",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "9.5px",
                    fontWeight: 800,
                  }}
                >
                  {activeCallout.balloonNumber}
                </span>
                <span style={{ color: "#38bdf8", fontWeight: 700 }}>{activeCallout.gdtSymbol}</span>
                <span style={{ fontWeight: 700 }}>
                  {activeCallout.isDiametrical ? "⌀" : ""}
                  {activeCallout.toleranceZone}
                  {formatMaterialModifier(activeCallout.materialCondition)}
                </span>
                <span style={{ color: "#cbd5e1", borderLeft: "1px solid #475569", paddingLeft: "6px" }}>
                  {activeCallout.datumReferences
                    .map((d) => `${d.datumLabel}${formatMaterialModifier(d.materialCondition)}`)
                    .join(" | ") || "Primary"}
                </span>
                {activeCallout.stepEntityId && (
                  <span style={{ color: "#38bdf8", borderLeft: "1px solid #475569", paddingLeft: "6px" }}>
                    STEP {activeCallout.stepEntityId}
                  </span>
                )}
                {activeCallout.measuredValue !== undefined && (
                  <span style={{ color: "#94a3b8", borderLeft: "1px solid #475569", paddingLeft: "6px" }}>
                    Act: <strong style={{ color: "#f8fafc" }}>{activeCallout.measuredValue.toFixed(3)}mm</strong>
                  </span>
                )}
                {activeCallout.cpk !== undefined && (
                  <span style={{ color: "#4ade80" }}>Cpk {activeCallout.cpk.toFixed(2)}</span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCharId(null);
                    setSelectedFeatureId(null);
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#94a3b8",
                    cursor: "pointer",
                    padding: "0 2px",
                    fontSize: "11px",
                  }}
                  aria-label="Clear selected GD&T callout"
                >
                  ✕
                </button>
              </Box>
            )}

            {
              <Box
                data-testid="qif-no-geometry-notice"
                position="absolute"
                top="52px"
                right="12px"
                zIndex={5}
                style={{
                  padding: "4px 10px",
                  borderRadius: "999px",
                  background: "rgba(15, 23, 42, 0.78)",
                  border: "1px solid rgba(148, 163, 184, 0.35)",
                  color: "#cbd5e1",
                  fontSize: "11px",
                  pointerEvents: "none",
                }}
                title={geometryNoticeDetail}
              >
                {geometryNotice}
              </Box>
            }

            <Canvas
              gl={{ preserveDrawingBuffer: true, localClippingEnabled: true }}
              camera={{ position: [36, -38, 28], up: [0, 0, 1], fov: 42 }}
              onPointerMissed={() => {
                setSelectedFeatureId(null);
                setSelectedCharId(null);
              }}
            >
              <AutoThumbnailCapture
                artifactId={typeof artifactId === "number" ? artifactId : undefined}
                hasThumbnail={Boolean(viewConfig?.thumbnailUrl || viewConfig?.thumbnail_url)}
              />
              <ambientLight intensity={0.55} />
              <directionalLight position={[30, -25, 40]} intensity={0.95} />
              <directionalLight position={[-25, 25, -15]} intensity={0.4} />
              <spotLight position={[10, 10, 35]} angle={0.3} penumbra={1} intensity={0.35} />

              <Suspense fallback={null}>
                <Environment files="/hdri/studio.hdr" environmentIntensity={0.3} />
              </Suspense>

              <group
                scale={[sceneScale, sceneScale, sceneScale]}
                position={[-sceneCenter[0] * sceneScale, -sceneCenter[1] * sceneScale, -sceneCenter[2] * sceneScale]}
              >
                {/* 1. 3D STEP AP242 B-Rep Solid & Individual Feature Topology Surfaces */}
                {scene.meshes.map((meshPayload) => (
                  <QifFeatureMesh
                    key={meshPayload.id}
                    payload={meshPayload}
                    isSelected={Boolean(meshPayload.featureId) && meshPayload.featureId === selectedFeatureId}
                    showHeatmap={showHeatmap}
                    renderMode={renderMode}
                    clippingPlanes={activeClippingPlanes}
                    onSelectFeature={(fid) => {
                      setSelectedFeatureId(fid ?? null);
                      setSelectedCharId(null);
                    }}
                  />
                ))}

                {/* 2. Compact Datum Reference Frame (DRF) Coordinate Axes at Origin */}
                <Line
                  points={[
                    [0, 0, 0],
                    [10, 0, 0],
                  ]}
                  color="#ef4444"
                  lineWidth={1.6}
                />
                <Line
                  points={[
                    [0, 0, 0],
                    [0, 10, 0],
                  ]}
                  color="#22c55e"
                  lineWidth={1.6}
                />
                <Line
                  points={[
                    [0, 0, 0],
                    [0, 0, 10],
                  ]}
                  color="#3b82f6"
                  lineWidth={1.6}
                />

                {/* 3. 3D CMM Touch-Probe Hit Spheres & Amplified Deviation Vectors */}
                {(showProbes || Boolean(selectedFeatureId)) &&
                  scene.probeHits.map((hit) => {
                    if (!showProbes && hit.featureId !== selectedFeatureId) return null;
                    const isHighlighted = !selectedFeatureId || hit.featureId === selectedFeatureId;
                    const devScale = 45;
                    const tip: [number, number, number] = [
                      hit.position[0] + hit.deviationVector[0] * devScale,
                      hit.position[1] + hit.deviationVector[1] * devScale,
                      hit.position[2] + hit.deviationVector[2] * devScale,
                    ];
                    return (
                      <group key={hit.id}>
                        <mesh position={hit.position}>
                          <sphereGeometry args={[isHighlighted ? 0.55 : 0.35, 10, 10]} />
                          <meshStandardMaterial
                            color={isHighlighted ? "#38bdf8" : "#475569"}
                            emissive={isHighlighted ? "#0284c7" : "#000000"}
                            emissiveIntensity={0.4}
                          />
                        </mesh>
                        {isHighlighted && <Line points={[hit.position, tip]} color="#38bdf8" lineWidth={1.2} />}
                      </group>
                    );
                  })}

                {/* 4. Compact 3D ASME Datum Reference Badges ([A], [B], [C]) */}
                {show3dLabels &&
                  scene.datumBadges.map((datum) => (
                    <group key={datum.datumId}>
                      <Line
                        points={[datum.surfaceAnchor, datum.badgePosition]}
                        color="#94a3b8"
                        lineWidth={1}
                        dashed
                        dashSize={1.5}
                        gapSize={1.5}
                      />
                      <Html position={datum.badgePosition} center zIndexRange={[1, 4]}>
                        <div
                          onClick={() => {
                            if (datum.featureId) {
                              setSelectedFeatureId((prev) => (prev === datum.featureId ? null : datum.featureId!));
                              setSelectedCharId(null);
                            }
                          }}
                          style={{
                            background: "rgba(15, 23, 42, 0.88)",
                            border: "1px solid #60a5fa",
                            borderRadius: "4px",
                            padding: "1px 5px",
                            color: "#f8fafc",
                            fontSize: "9.5px",
                            fontWeight: 700,
                            fontFamily: "var(--font-mono, monospace)",
                            whiteSpace: "nowrap",
                            cursor: "pointer",
                            boxShadow: "0 2px 6px rgba(0,0,0,0.35)",
                          }}
                          title={`Datum ${datum.datumLabel} (${datum.featureName ?? ""} ${datum.stepEntityId ?? ""})`}
                        >
                          [{datum.datumLabel}]
                        </div>
                      </Html>
                    </group>
                  ))}

                {/* 5. Spatially Separated 3D Balloon Callouts & Leader Lines */}
                {show3dLabels &&
                  scene.callouts.map((callout) => {
                    const statusColor = getStatusHexColor(callout.status, callout.toleranceRatio);
                    const isActive =
                      selectedCharId === callout.characteristicId || selectedFeatureId === callout.featureId;
                    return (
                      <group key={callout.characteristicId}>
                        <Line
                          points={[callout.surfaceAnchor, callout.leaderElbow, callout.calloutPosition]}
                          color={isActive ? "#38bdf8" : statusColor}
                          lineWidth={isActive ? 2 : 1.1}
                        />
                        <mesh position={callout.surfaceAnchor}>
                          <sphereGeometry args={[0.7, 10, 10]} />
                          <meshBasicMaterial color={isActive ? "#38bdf8" : statusColor} />
                        </mesh>
                        <Html position={callout.calloutPosition} center zIndexRange={[1, 5]}>
                          <div
                            onClick={() => handleSelectCallout(callout)}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                              background: isActive ? "rgba(14, 116, 144, 0.95)" : "rgba(15, 23, 42, 0.88)",
                              border: `1.2px solid ${isActive ? "#38bdf8" : statusColor}`,
                              borderRadius: "999px",
                              padding: "1.5px 6px 1.5px 3px",
                              color: "#f8fafc",
                              fontSize: "9.5px",
                              fontWeight: 600,
                              fontFamily: "var(--font-mono, monospace)",
                              whiteSpace: "nowrap",
                              cursor: "pointer",
                              boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
                            }}
                            title={`${callout.characteristicName} (${callout.featureName} ${callout.stepEntityId ?? ""}) — Click to inspect`}
                          >
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                width: "14px",
                                height: "14px",
                                borderRadius: "50%",
                                background: statusColor,
                                color: "#0f172a",
                                fontWeight: 800,
                                fontSize: "9px",
                              }}
                            >
                              {callout.balloonNumber}
                            </span>
                            <span style={{ color: "#38bdf8", fontWeight: 700 }}>{callout.gdtSymbol}</span>
                            <span>
                              {callout.isDiametrical ? "⌀" : ""}
                              {callout.toleranceZone}
                              {formatMaterialModifier(callout.materialCondition)}
                            </span>
                          </div>
                        </Html>
                      </group>
                    );
                  })}
              </group>

              <CameraController controlsRef={controlsRef} presetTrigger={presetTrigger} />
              <SafeOrbitControls controlsRef={controlsRef} isFullScreen={isFullScreen} />
            </Canvas>

            {/* Bottom-Left Unified MBD Overlay Pill Bar (non-overlapping with top-left camera controls) */}
            <Box
              position="absolute"
              bottom={12}
              left={12}
              zIndex={10}
              px={2}
              py={1}
              borderRadius="20px"
              bg="rgba(15, 23, 42, 0.78)"
              border="1px solid rgba(255, 255, 255, 0.12)"
              display="flex"
              alignItems="center"
              gap={1}
              style={{
                backdropFilter: "blur(10px)",
                boxShadow: "0 4px 16px rgba(0, 0, 0, 0.35)",
                userSelect: "none",
              }}
            >
              {[
                {
                  label: "Heatmap",
                  active: showHeatmap,
                  toggle: () => setShowHeatmap((v) => !v),
                  dotColor: "#22c55e",
                },
                {
                  label: `CMM Hits (${scene.probeHits.length})`,
                  active: showProbes,
                  toggle: () => setShowProbes((v) => !v),
                  dotColor: "#38bdf8",
                },
                {
                  label: `GD&T Pins (${scene.callouts.length})`,
                  active: show3dLabels,
                  toggle: () => setShow3dLabels((v) => !v),
                  dotColor: "#f59e0b",
                },
              ].map((btn) => (
                <button
                  key={btn.label}
                  type="button"
                  onClick={btn.toggle}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "5px",
                    fontSize: "10px",
                    fontWeight: 700,
                    fontFamily: "var(--font-mono, monospace)",
                    padding: "2px 8px",
                    borderRadius: "12px",
                    cursor: "pointer",
                    background: btn.active ? "rgba(6, 182, 212, 0.25)" : "transparent",
                    color: btn.active ? "#38bdf8" : "#cbd5e1",
                    border: btn.active ? "1px solid rgba(6, 182, 212, 0.4)" : "1px solid transparent",
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: btn.active ? btn.dotColor : "#64748b",
                    }}
                  />
                  {btn.label}
                </button>
              ))}
            </Box>

            {/* Bottom-Right Compact Metrology Status Pill */}
            <Box
              position="absolute"
              bottom={12}
              right={12}
              zIndex={10}
              px={2}
              py={1}
              borderRadius="20px"
              bg="rgba(15, 23, 42, 0.78)"
              border="1px solid rgba(255, 255, 255, 0.12)"
              display="flex"
              alignItems="center"
              gap={2}
              style={{
                backdropFilter: "blur(10px)",
                fontFamily: "var(--font-mono, monospace)",
                fontSize: "10px",
                color: "#cbd5e1",
                userSelect: "none",
              }}
            >
              <span style={{ color: "#4ade80", fontWeight: 700 }}>
                B-Rep {scene.reconciliation.matchedFeatures.length}/{doc.features.length} Faces
              </span>
              <span style={{ color: "#64748b" }}>·</span>
              <span style={{ color: "#38bdf8", fontWeight: 700 }}>Min Cpk {scene.spcSummary.minCpk.toFixed(2)}</span>
            </Box>
          </Box>
        )}

        {/* Bill of Characteristics (BoC) & ASME Y14.5 Feature Control Frames Tab */}
        {viewTab === "boc" && (
          <Box flex={1} overflow="auto" p={3} bg="var(--color-canvas-default, #0d1117)">
            <Box
              mb={2}
              pb={2}
              display="flex"
              alignItems="center"
              justifyContent="space-between"
              borderBottom="1px solid var(--color-border-default, #30363d)"
            >
              <Text
                style={{
                  fontSize: "11.5px",
                  fontWeight: 700,
                  color: "var(--color-fg-default, #e6edf3)",
                }}
              >
                ASME Y14.5 Feature Control Frames &amp; CMM Actuals
              </Text>
              <Text style={{ fontSize: "10.5px", color: "var(--color-fg-muted, #8b949e)" }}>
                Click any row to isolate its 3D STEP B-Rep surface
              </Text>
            </Box>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "11.5px",
                fontFamily: "var(--font-mono, monospace)",
                color: "var(--color-fg-default, #e6edf3)",
              }}
            >
              <thead>
                <tr
                  style={{
                    borderBottom: "1px solid var(--color-border-default, #30363d)",
                    textAlign: "left",
                    color: "var(--color-fg-muted, #8b949e)",
                  }}
                >
                  <th style={{ padding: "8px" }}>#</th>
                  <th style={{ padding: "8px" }}>Characteristic</th>
                  <th style={{ padding: "8px" }}>STEP B-Rep Face</th>
                  <th style={{ padding: "8px" }}>ASME Y14.5 Callout</th>
                  <th style={{ padding: "8px" }}>DRF</th>
                  <th style={{ padding: "8px" }}>Measured</th>
                  <th style={{ padding: "8px" }}>Eff. Tol (Bonus)</th>
                  <th style={{ padding: "8px" }}>Cpk</th>
                  <th style={{ padding: "8px" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {scene.callouts.map((c) => {
                  const statusColor = getStatusHexColor(c.status, c.toleranceRatio);
                  return (
                    <tr
                      key={c.characteristicId}
                      onClick={() => {
                        setSelectedFeatureId(c.featureId);
                        setSelectedCharId(c.characteristicId);
                        setViewTab("3d");
                      }}
                      style={{
                        borderBottom: "1px solid var(--color-border-muted, rgba(48, 54, 61, 0.6))",
                        cursor: "pointer",
                      }}
                    >
                      <td style={{ padding: "8px", fontWeight: 700 }}>{c.balloonNumber}</td>
                      <td style={{ padding: "8px" }}>{c.characteristicName}</td>
                      <td style={{ padding: "8px", color: "#0284c7" }}>
                        {c.stepEntityId ?? "—"} ({c.featureName})
                      </td>
                      <td style={{ padding: "8px", fontWeight: 700 }}>
                        {c.gdtSymbol} {c.isDiametrical ? "⌀" : ""}
                        {c.toleranceZone} {formatMaterialModifier(c.materialCondition)}
                      </td>
                      <td style={{ padding: "8px" }}>
                        {c.datumReferences
                          .map((d) => `${d.datumLabel}${formatMaterialModifier(d.materialCondition)}`)
                          .join(" | ") || "Primary"}
                      </td>
                      <td style={{ padding: "8px" }}>
                        {c.measuredValue !== undefined ? `${c.measuredValue.toFixed(4)} mm` : "—"}
                      </td>
                      <td style={{ padding: "8px" }}>
                        {c.effectiveTolerance.toFixed(4)} mm
                        {c.bonusTolerance > 0 ? ` (+${c.bonusTolerance.toFixed(3)})` : ""}
                      </td>
                      <td style={{ padding: "8px", color: "#16a34a", fontWeight: 600 }}>{c.cpk?.toFixed(2) ?? "—"}</td>
                      <td style={{ padding: "8px" }}>
                        <span
                          style={{
                            padding: "2px 8px",
                            borderRadius: "999px",
                            background: `${statusColor}22`,
                            color: statusColor,
                            border: `1px solid ${statusColor}`,
                            fontSize: "10px",
                            fontWeight: 700,
                          }}
                        >
                          {c.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Box>
        )}

        {/* SPC Capability & 2D Schematic Export Tab */}
        {viewTab === "spc" && (
          <Box
            flex={1}
            overflow="auto"
            p={3}
            display="flex"
            flexDirection="column"
            gap={3}
            bg="var(--color-canvas-default, #0d1117)"
          >
            <Box
              border="1px solid var(--color-border-default, #30363d)"
              borderRadius="6px"
              p={2}
              bg={isDark ? "#0f172a" : "#ffffff"}
              dangerouslySetInnerHTML={{ __html: spcSvg }}
            />
            <Box
              border="1px solid var(--color-border-default, #30363d)"
              borderRadius="6px"
              p={2}
              bg={isDark ? "#0f172a" : "#ffffff"}
              dangerouslySetInnerHTML={{ __html: heatmapSvg }}
            />
          </Box>
        )}

        {/* QIF 3.0 XML & Paired STEP AP242 Source Tab */}
        {viewTab === "code" && (
          <Box
            flex={1}
            display="flex"
            flexDirection="column"
            overflow="hidden"
            bg="var(--color-canvas-default, #0d1117)"
          >
            <Box
              px={3}
              py={2}
              display="flex"
              alignItems="center"
              justifyContent="space-between"
              borderBottom="1px solid var(--color-border-default, #30363d)"
              bg="var(--color-canvas-subtle, #161b22)"
            >
              <Box display="flex" alignItems="center" gap={2}>
                <button
                  type="button"
                  onClick={() => setSourceSubTab("qif")}
                  style={{
                    fontSize: "11px",
                    fontWeight: 600,
                    padding: "2px 8px",
                    borderRadius: "4px",
                    cursor: "pointer",
                    background: sourceSubTab === "qif" ? "rgba(56, 189, 248, 0.2)" : "transparent",
                    color: sourceSubTab === "qif" ? "#38bdf8" : "#94a3b8",
                    border: sourceSubTab === "qif" ? "1px solid rgba(56, 189, 248, 0.4)" : "1px solid transparent",
                  }}
                >
                  ISO 23952 QIF 3.0 XML
                </button>
                {pairedStepText && (
                  <button
                    type="button"
                    onClick={() => setSourceSubTab("step")}
                    style={{
                      fontSize: "11px",
                      fontWeight: 600,
                      padding: "2px 8px",
                      borderRadius: "4px",
                      cursor: "pointer",
                      background: sourceSubTab === "step" ? "rgba(56, 189, 248, 0.2)" : "transparent",
                      color: sourceSubTab === "step" ? "#38bdf8" : "#94a3b8",
                      border: sourceSubTab === "step" ? "1px solid rgba(56, 189, 248, 0.4)" : "1px solid transparent",
                    }}
                  >
                    Paired STEP{geometryTitle ? ` · ${geometryTitle}` : ""}
                  </button>
                )}
              </Box>
              <Box display="flex" alignItems="center" gap={2}>
                <Button size="small" leadingVisual={DownloadIcon} onClick={handleDownloadQif}>
                  {sourceSubTab === "qif" ? ".qif" : ".step"}
                </Button>
                <Button size="small" leadingVisual={copied ? CheckIcon : CopyIcon} onClick={handleCopySource}>
                  {copied ? "Copied" : "Copy"}
                </Button>
              </Box>
            </Box>

            <Box
              flex={1}
              py={2}
              overflow="auto"
              style={{
                fontFamily: "var(--font-mono, monospace)",
                fontSize: "12px",
                lineHeight: 1.55,
              }}
            >
              {activeSourceLines.map((line, idx) => (
                <div key={idx} style={{ display: "flex", padding: "0 14px" }}>
                  <span
                    style={{
                      userSelect: "none",
                      width: "40px",
                      minWidth: "40px",
                      textAlign: "right",
                      paddingRight: "14px",
                      color: "var(--color-fg-subtle, #6e7681)",
                      fontSize: "11px",
                    }}
                  >
                    {idx + 1}
                  </span>
                  <span style={{ whiteSpace: "pre" }}>
                    {highlightPolyglotLine(line, sourceSubTab === "qif" ? "qif" : "step")}
                  </span>
                </div>
              ))}
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
};

export const QifViewer: React.FC<QifViewerProps> = (props) => {
  const { viewConfig } = props;
  const validation = useMemo((): { ok: true } | { ok: false; message: string } => {
    const cfg = (viewConfig && typeof viewConfig === "object" ? viewConfig : {}) as Record<string, unknown>;
    const candidate = cfg["code"] || cfg["qifCode"] || cfg["source"] || cfg["content"] || "";
    const text = typeof candidate === "string" ? candidate : "";
    if (text.trim().length === 0) {
      return { ok: false, message: "This artifact has no QIF content." };
    }
    try {
      const doc = parseQif(text);
      if (doc.features.length === 0 && doc.characteristics.length === 0) {
        return { ok: false, message: "No features or characteristics were found in this QIF file." };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, message: `Could not parse QIF: ${err instanceof Error ? err.message : String(err)}` };
    }
  }, [viewConfig]);

  if (!validation.ok) {
    return (
      <Box
        data-testid="qif-viewer-error"
        role="alert"
        display="flex"
        alignItems="center"
        justifyContent="center"
        width="100%"
        height={props.isFullScreen ? "100%" : "480px"}
        bg="var(--color-canvas-default, #0d1117)"
        color="var(--color-fg-muted, #8b949e)"
        style={{ padding: "24px", textAlign: "center", fontSize: "13px" }}
      >
        {validation.message}
      </Box>
    );
  }
  return <QifViewerInner {...props} />;
};

export default QifViewer;
