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
import { DraftingTriangleIcon } from "../icons";
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

export interface Qif3dAnnotation {
  id: string;
  position: [number, number, number];
  author: string;
  text: string;
  createdAt: string;
  featureId?: string;
  resolved?: boolean;
}

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

export interface FeatureControlFrameProps {
  symbol: string;
  isDiametrical?: boolean;
  toleranceZone: string | number;
  materialCondition?: "RFS" | "MMC" | "LMC";
  datumReferences?: Array<{ datumLabel: string; materialCondition?: "RFS" | "MMC" | "LMC" }>;
  status?: string;
  toleranceRatio?: number;
  compact?: boolean;
}

export function FeatureControlFrame({
  symbol,
  isDiametrical,
  toleranceZone,
  materialCondition,
  datumReferences = [],
  status,
  toleranceRatio = 0,
  compact = false,
}: FeatureControlFrameProps): React.ReactElement {
  const statusColor = status ? getStatusHexColor(status, toleranceRatio) : "#38bdf8";
  const modStr = formatMaterialModifier(materialCondition);

  return (
    <div
      data-testid="feature-control-frame"
      style={{
        display: "inline-flex",
        alignItems: "stretch",
        border: `1.5px solid ${statusColor}`,
        borderRadius: compact ? "2px" : "3px",
        background: "rgba(15, 23, 42, 0.92)",
        fontFamily: "var(--font-mono, monospace)",
        fontSize: compact ? "9.5px" : "11px",
        color: "#f8fafc",
        overflow: "hidden",
        verticalAlign: "middle",
        userSelect: "none",
        lineHeight: 1.2,
      }}
    >
      {/* 1. Geometric Characteristic Symbol */}
      <div
        style={{
          padding: compact ? "1px 4px" : "2px 6px",
          borderRight: `1px solid ${statusColor}`,
          fontWeight: 700,
          color: "#38bdf8",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(56, 189, 248, 0.08)",
        }}
      >
        {symbol}
      </div>

      {/* 2. Tolerance Zone & Material Condition Modifier */}
      <div
        style={{
          padding: compact ? "1px 5px" : "2px 7px",
          borderRight: datumReferences.length > 0 ? `1px solid ${statusColor}` : undefined,
          fontWeight: 600,
          whiteSpace: "nowrap",
          display: "flex",
          alignItems: "center",
          gap: 2,
        }}
      >
        {isDiametrical && <span>⌀</span>}
        <span>{toleranceZone}</span>
        {modStr && <span style={{ fontSize: compact ? "9px" : "10px", color: "#38bdf8" }}>{modStr}</span>}
      </div>

      {/* 3. Datum Reference Frame Compartments */}
      {datumReferences.map((d, i) => {
        const dMod = formatMaterialModifier(d.materialCondition);
        return (
          <div
            key={i}
            style={{
              padding: compact ? "1px 4px" : "2px 6px",
              borderRight: i < datumReferences.length - 1 ? `1px solid ${statusColor}` : undefined,
              fontWeight: 700,
              color: "#e2e8f0",
              display: "flex",
              alignItems: "center",
              gap: 1,
            }}
          >
            <span>{d.datumLabel}</span>
            {dMod && <span style={{ fontSize: compact ? "8.5px" : "9.5px", color: "#38bdf8" }}>{dMod}</span>}
          </div>
        );
      })}
    </div>
  );
}

interface OrbitControlsHandle {
  target: { set: (x: number, y: number, z: number) => void };
  update: () => void;
}

function CameraController({
  controlsRef,
  presetTrigger,
  focusTarget,
}: {
  controlsRef: React.RefObject<OrbitControlsHandle | null>;
  presetTrigger: { preset: CameraPreset; timestamp: number } | null;
  focusTarget?: { point: [number, number, number]; timestamp: number } | null;
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

  useEffect(() => {
    if (!focusTarget) return;
    const [fx, fy, fz] = focusTarget.point;
    camera.up.set(0, 0, 1);
    camera.position.set(fx + 20, fy - 20, fz + 16);
    camera.lookAt(fx, fy, fz);
    if (controlsRef.current) {
      controlsRef.current.target.set(fx, fy, fz);
      controlsRef.current.update();
    }
  }, [focusTarget, camera, controlsRef]);

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

  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

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

let focusTriggerCounter = 0;

const QifViewerInner: React.FC<QifViewerProps & { parsedDoc?: QifDocument }> = ({
  artifactId,
  viewConfig,
  isFullScreen = false,
  parsedDoc,
}) => {
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
  const [whiskerScale, setWhiskerScale] = useState<number>(50);
  const [tourIndex, setTourIndex] = useState<number>(0);
  const [focusTrigger, setFocusTrigger] = useState<{ point: [number, number, number]; timestamp: number } | null>(null);
  const [activeSerial, setActiveSerial] = useState<string | undefined>(undefined);

  const initialAnnotations: Qif3dAnnotation[] = useMemo(() => {
    const cfg = (viewConfig && typeof viewConfig === "object" ? viewConfig : {}) as Record<string, unknown>;
    const raw = cfg["annotations"] || cfg["spatialAnnotations"] || cfg["notes"];
    return Array.isArray(raw) ? (raw as Qif3dAnnotation[]) : [];
  }, [viewConfig]);

  const [annotations, setAnnotations] = useState<Qif3dAnnotation[]>(initialAnnotations);
  const [showAnnotations, setShowAnnotations] = useState<boolean>(true);
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);

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
  } => {
    const doc: QifDocument = parsedDoc ?? parseQif(rawQifText);
    const scene = buildQif3dMbdScene(doc, pairedStepText, activeSerial);
    return {
      doc,
      scene,
    };
  }, [parsedDoc, rawQifText, pairedStepText, activeSerial]);

  const activeAnnotation = useMemo(
    () => annotations.find((a) => a.id === activeAnnotationId) ?? null,
    [annotations, activeAnnotationId],
  );

  const spcSvg = useMemo(() => {
    if (viewTab !== "spc") return "";
    const rawSpcSvg = DOMPurify.sanitize(renderQifSpcChartSvg(baseParsedData.scene.spcSummary));
    return adaptSvgMarkupForTheme(rawSpcSvg, isDark);
  }, [viewTab, baseParsedData.scene.spcSummary, isDark]);

  const heatmapSvg = useMemo(() => {
    if (viewTab !== "spc") return "";
    const rawHeatmapSvg = DOMPurify.sanitize(
      renderQifMbdHeatmapSvg(baseParsedData.doc, baseParsedData.scene.spcSummary),
    );
    return adaptSvgMarkupForTheme(rawHeatmapSvg, isDark);
  }, [viewTab, baseParsedData.doc, baseParsedData.scene.spcSummary, isDark]);

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

  const unitScale = useMemo(() => {
    return scene.boundingBox.radius > 0 ? scene.boundingBox.radius / 40 : 1;
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

  const issueCallouts = useMemo(() => {
    return scene.callouts.filter(
      (c) => c.status === "FAIL" || c.status === "MARGINAL" || c.status === "REWORK" || c.toleranceRatio > 0.75,
    );
  }, [scene.callouts]);

  const handleTourStep = (direction: 1 | -1 = 1) => {
    if (issueCallouts.length === 0) return;
    const nextIdx = (tourIndex + direction + issueCallouts.length) % issueCallouts.length;
    setTourIndex(nextIdx);
    const target = issueCallouts[nextIdx];
    if (target) {
      setSelectedCharId(target.characteristicId);
      setSelectedFeatureId(target.featureId);
      setFocusTrigger({
        point: [
          (target.surfaceAnchor[0] - sceneCenter[0]) * sceneScale,
          (target.surfaceAnchor[1] - sceneCenter[1]) * sceneScale,
          (target.surfaceAnchor[2] - sceneCenter[2]) * sceneScale,
        ],
        timestamp: ++focusTriggerCounter,
      });
    }
  };

  const handleSelectCalloutWithFocus = (callout: Qif3dCalloutAnchor) => {
    handleSelectCallout(callout);
    setFocusTrigger({
      point: [
        (callout.surfaceAnchor[0] - sceneCenter[0]) * sceneScale,
        (callout.surfaceAnchor[1] - sceneCenter[1]) * sceneScale,
        (callout.surfaceAnchor[2] - sceneCenter[2]) * sceneScale,
      ],
      timestamp: ++focusTriggerCounter,
    });
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
    if (viewTab !== "code") return [];
    const text = sourceSubTab === "qif" ? rawQifText : (pairedStepText ?? "");
    return text.split(/\r?\n/);
  }, [viewTab, sourceSubTab, rawQifText, pairedStepText]);

  const currentSerialIdx = useMemo(() => {
    if (!scene.availableSerialNumbers || scene.availableSerialNumbers.length === 0) return 0;
    const rawIdx = scene.availableSerialNumbers.indexOf(activeSerial ?? scene.activeSerialNumber ?? "");
    return rawIdx >= 0 ? rawIdx : 0;
  }, [scene.availableSerialNumbers, activeSerial, scene.activeSerialNumber]);

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
              {scene.availableSerialNumbers && scene.availableSerialNumbers.length > 1 && (
                <div
                  data-testid="qif-serial-scrubber"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    background: "rgba(15, 23, 42, 0.6)",
                    border: "1px solid var(--color-border-default, #30363d)",
                    borderRadius: "14px",
                    padding: "1px 7px",
                    fontSize: "10px",
                    fontFamily: "var(--font-mono, monospace)",
                    color: "#cbd5e1",
                  }}
                >
                  <span style={{ color: "#94a3b8" }}>SN:</span>
                  <button
                    type="button"
                    disabled={currentSerialIdx <= 0}
                    onClick={() => {
                      if (currentSerialIdx > 0) {
                        setActiveSerial(scene.availableSerialNumbers![currentSerialIdx - 1]);
                      }
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      color: currentSerialIdx > 0 ? "#38bdf8" : "#475569",
                      cursor: currentSerialIdx > 0 ? "pointer" : "default",
                      padding: "0 2px",
                      fontWeight: 800,
                      fontSize: "9px",
                    }}
                    title="Previous part serial number"
                    aria-label="Previous serial number"
                  >
                    ◀
                  </button>
                  <span style={{ fontWeight: 700, color: "#38bdf8" }}>
                    {scene.availableSerialNumbers[currentSerialIdx]}
                  </span>
                  <button
                    type="button"
                    disabled={currentSerialIdx >= scene.availableSerialNumbers.length - 1}
                    onClick={() => {
                      if (currentSerialIdx < scene.availableSerialNumbers!.length - 1) {
                        setActiveSerial(scene.availableSerialNumbers![currentSerialIdx + 1]);
                      }
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      color: currentSerialIdx < scene.availableSerialNumbers.length - 1 ? "#38bdf8" : "#475569",
                      cursor: currentSerialIdx < scene.availableSerialNumbers.length - 1 ? "pointer" : "default",
                      padding: "0 2px",
                      fontWeight: 800,
                      fontSize: "9px",
                    }}
                    title="Next part serial number"
                    aria-label="Next serial number"
                  >
                    ▶
                  </button>
                </div>
              )}
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
                <Button
                  size="small"
                  variant="primary"
                  leadingVisual={DraftingTriangleIcon}
                  onClick={handleOpenInPlayground}
                >
                  Open in Morsel
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
                    width: "18px",
                    height: "18px",
                    borderRadius: "50%",
                    background: getStatusHexColor(activeCallout.status, activeCallout.toleranceRatio),
                    color: "#0f172a",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "10px",
                    fontWeight: 800,
                    flexShrink: 0,
                  }}
                >
                  {activeCallout.balloonNumber}
                </span>
                <FeatureControlFrame
                  symbol={activeCallout.gdtSymbol}
                  isDiametrical={activeCallout.isDiametrical}
                  toleranceZone={activeCallout.toleranceZone}
                  materialCondition={activeCallout.materialCondition}
                  datumReferences={activeCallout.datumReferences}
                  status={activeCallout.status}
                  toleranceRatio={activeCallout.toleranceRatio}
                />
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

            {/* Floating 3D Spatial Annotation Card (positioned below ViewportCameraControls) */}
            {activeAnnotation && (
              <Box
                data-testid="qif-active-annotation-card"
                position="absolute"
                top={52}
                left={12}
                zIndex={15}
                p={2}
                borderRadius="10px"
                bg="rgba(15, 23, 42, 0.92)"
                border="1px solid rgba(245, 158, 11, 0.6)"
                style={{
                  backdropFilter: "blur(10px)",
                  boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
                  maxWidth: "260px",
                  fontSize: "11px",
                  color: "#f8fafc",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 4,
                  }}
                >
                  <span style={{ fontWeight: 700, color: "#f59e0b" }}>💬 {activeAnnotation.author}</span>
                  <button
                    type="button"
                    onClick={() => setActiveAnnotationId(null)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#94a3b8",
                      cursor: "pointer",
                      fontSize: "11px",
                    }}
                  >
                    ✕
                  </button>
                </div>
                <div style={{ marginBottom: 6, lineHeight: 1.4, color: "#e2e8f0" }}>{activeAnnotation.text}</div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    fontSize: "10px",
                    color: "#94a3b8",
                  }}
                >
                  <span>{activeAnnotation.createdAt}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setAnnotations((prev) =>
                        prev.map((a) => (a.id === activeAnnotation.id ? { ...a, resolved: !a.resolved } : a)),
                      );
                    }}
                    style={{
                      background: activeAnnotation.resolved ? "rgba(34, 197, 94, 0.2)" : "rgba(245, 158, 11, 0.2)",
                      color: activeAnnotation.resolved ? "#4ade80" : "#fbbf24",
                      border: `1px solid ${activeAnnotation.resolved ? "#22c55e" : "#f59e0b"}`,
                      borderRadius: "8px",
                      padding: "1px 6px",
                      cursor: "pointer",
                      fontWeight: 700,
                    }}
                  >
                    {activeAnnotation.resolved ? "✓ Resolved" : "Mark Resolved"}
                  </button>
                </div>
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
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "4px 10px",
                  borderRadius: "999px",
                  background: geometryState.status === "ready" ? "rgba(15, 23, 42, 0.88)" : "rgba(15, 23, 42, 0.78)",
                  border:
                    geometryState.status === "ready"
                      ? "1px solid rgba(56, 189, 248, 0.4)"
                      : "1px solid rgba(148, 163, 184, 0.35)",
                  color: geometryState.status === "ready" ? "#e0f2fe" : "#cbd5e1",
                  fontSize: "11px",
                  pointerEvents: "none",
                }}
                title={geometryNoticeDetail}
              >
                {geometryState.status === "ready" && (
                  <span
                    style={{
                      width: "6px",
                      height: "6px",
                      borderRadius: "50%",
                      background: "#38bdf8",
                      boxShadow: "0 0 6px rgba(56, 189, 248, 0.8)",
                      flexShrink: 0,
                    }}
                  />
                )}
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
                    [10 * unitScale, 0, 0],
                  ]}
                  color="#ef4444"
                  lineWidth={1.6}
                />
                <Line
                  points={[
                    [0, 0, 0],
                    [0, 10 * unitScale, 0],
                  ]}
                  color="#22c55e"
                  lineWidth={1.6}
                />
                <Line
                  points={[
                    [0, 0, 0],
                    [0, 0, 10 * unitScale],
                  ]}
                  color="#3b82f6"
                  lineWidth={1.6}
                />

                {/* 3. 3D CMM Touch-Probe Hit Spheres & Amplified Deviation Vectors */}
                {(showProbes || Boolean(selectedFeatureId)) &&
                  scene.probeHits.map((hit) => {
                    if (!showProbes && hit.featureId !== selectedFeatureId) return null;
                    const isHighlighted = !selectedFeatureId || hit.featureId === selectedFeatureId;
                    const hitStatusColor =
                      hit.status === "FAIL" ? "#ef4444" : hit.status === "MARGINAL" ? "#f59e0b" : "#22c55e";
                    const whiskerColor = isHighlighted ? (hit.status === "FAIL" ? "#ef4444" : "#38bdf8") : "#475569";
                    const tip: [number, number, number] = [
                      hit.position[0] + hit.deviationVector[0] * whiskerScale,
                      hit.position[1] + hit.deviationVector[1] * whiskerScale,
                      hit.position[2] + hit.deviationVector[2] * whiskerScale,
                    ];
                    return (
                      <group key={hit.id}>
                        <mesh position={hit.position}>
                          <sphereGeometry args={[(isHighlighted ? 0.55 : 0.35) * unitScale, 10, 10]} />
                          <meshStandardMaterial
                            color={isHighlighted ? hitStatusColor : "#475569"}
                            emissive={isHighlighted ? hitStatusColor : "#000000"}
                            emissiveIntensity={0.5}
                          />
                        </mesh>
                        {isHighlighted && (
                          <>
                            <Line points={[hit.position, tip]} color={whiskerColor} lineWidth={1.6} />
                            <mesh position={tip}>
                              <sphereGeometry args={[0.22 * unitScale, 6, 6]} />
                              <meshBasicMaterial color={whiskerColor} />
                            </mesh>
                          </>
                        )}
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
                        dashSize={1.5 * unitScale}
                        gapSize={1.5 * unitScale}
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
                          <sphereGeometry args={[0.7 * unitScale, 10, 10]} />
                          <meshBasicMaterial color={isActive ? "#38bdf8" : statusColor} />
                        </mesh>
                        <Html position={callout.calloutPosition} center zIndexRange={[1, 5]}>
                          <div
                            onClick={() => handleSelectCalloutWithFocus(callout)}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                              background: isActive ? "rgba(14, 116, 144, 0.95)" : "rgba(15, 23, 42, 0.90)",
                              border: `1.2px solid ${isActive ? "#38bdf8" : statusColor}`,
                              borderRadius: "4px",
                              padding: "2px 4px",
                              color: "#f8fafc",
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
                                width: "15px",
                                height: "15px",
                                borderRadius: "50%",
                                background: statusColor,
                                color: "#0f172a",
                                fontWeight: 800,
                                fontSize: "9px",
                                flexShrink: 0,
                              }}
                            >
                              {callout.balloonNumber}
                            </span>
                            <FeatureControlFrame
                              symbol={callout.gdtSymbol}
                              isDiametrical={callout.isDiametrical}
                              toleranceZone={callout.toleranceZone}
                              materialCondition={callout.materialCondition}
                              datumReferences={callout.datumReferences}
                              status={callout.status}
                              toleranceRatio={callout.toleranceRatio}
                              compact={true}
                            />
                          </div>
                        </Html>
                      </group>
                    );
                  })}

                {/* 6. 3D Spatial Collaboration Annotations / Review Pins */}
                {showAnnotations &&
                  annotations.map((ann) => {
                    const isActive = activeAnnotationId === ann.id;
                    const pinColor = ann.resolved ? "#22c55e" : "#f59e0b";
                    return (
                      <group key={ann.id}>
                        <mesh
                          position={ann.position}
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveAnnotationId((prev) => (prev === ann.id ? null : ann.id));
                          }}
                        >
                          <sphereGeometry args={[(isActive ? 0.9 : 0.6) * unitScale, 12, 12]} />
                          <meshStandardMaterial
                            color={pinColor}
                            emissive={pinColor}
                            emissiveIntensity={isActive ? 0.6 : 0.25}
                          />
                        </mesh>
                        <Html
                          position={[ann.position[0], ann.position[1], ann.position[2] + 2 * unitScale]}
                          center
                          zIndexRange={[1, 6]}
                        >
                          <div
                            data-testid={`qif-annotation-pin-${ann.id}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveAnnotationId((prev) => (prev === ann.id ? null : ann.id));
                            }}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "3px",
                              background: isActive ? "rgba(245, 158, 11, 0.95)" : "rgba(15, 23, 42, 0.90)",
                              border: `1.2px solid ${pinColor}`,
                              borderRadius: "10px",
                              padding: "1px 6px",
                              color: isActive ? "#0f172a" : "#fef3c7",
                              fontWeight: 700,
                              fontSize: "9.5px",
                              cursor: "pointer",
                              boxShadow: "0 2px 6px rgba(0,0,0,0.4)",
                              whiteSpace: "nowrap",
                            }}
                            title={`Note by ${ann.author}: ${ann.text}`}
                          >
                            <span>💬</span>
                            <span>{ann.author}</span>
                          </div>
                        </Html>
                      </group>
                    );
                  })}
              </group>

              <CameraController controlsRef={controlsRef} presetTrigger={presetTrigger} focusTarget={focusTrigger} />
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
                  testId: "qif-toggle-heatmap-btn",
                },
                {
                  label: `CMM Hits (${scene.probeHits.length})`,
                  active: showProbes,
                  toggle: () => setShowProbes((v) => !v),
                  dotColor: "#38bdf8",
                  testId: "qif-toggle-probes-btn",
                },
                {
                  label: `GD&T Pins (${scene.callouts.length})`,
                  active: show3dLabels,
                  toggle: () => setShow3dLabels((v) => !v),
                  dotColor: "#f59e0b",
                  testId: "qif-toggle-callouts-btn",
                },
                {
                  label: `Notes (${annotations.length})`,
                  active: showAnnotations,
                  toggle: () => setShowAnnotations((v) => !v),
                  dotColor: "#fbbf24",
                  testId: "qif-toggle-annotations-btn",
                },
              ].map((btn) => (
                <button
                  key={btn.label}
                  data-testid={btn.testId}
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

              {/* Quick Add Spatial Note */}
              <button
                type="button"
                data-testid="qif-add-annotation-btn"
                onClick={() => {
                  const newId = `ann-${Date.now()}`;
                  const targetCallout = activeCallout ?? issueCallouts[tourIndex] ?? scene.callouts[0] ?? null;
                  const selectedFeat = selectedFeatureId
                    ? doc.features.find((f) => f.id === selectedFeatureId)
                    : undefined;
                  const noteAnchor: [number, number, number] = targetCallout
                    ? [targetCallout.surfaceAnchor[0], targetCallout.surfaceAnchor[1], targetCallout.surfaceAnchor[2]]
                    : selectedFeat
                      ? [selectedFeat.location[0], selectedFeat.location[1], selectedFeat.location[2]]
                      : [sceneCenter[0] + annotations.length * 1.5 * unitScale, sceneCenter[1], sceneCenter[2]];
                  const newNote: Qif3dAnnotation = {
                    id: newId,
                    position: noteAnchor,
                    featureId: targetCallout?.featureId ?? selectedFeatureId ?? undefined,
                    author: "Inspector",
                    text: targetCallout
                      ? `Review required on ${targetCallout.characteristicName} (${targetCallout.featureName}).`
                      : "Review required on this zone.",
                    createdAt: "Just now",
                    resolved: false,
                  };
                  setAnnotations((prev) => [...prev, newNote]);
                  setActiveAnnotationId(newId);
                  setShowAnnotations(true);
                }}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "3px",
                  fontSize: "10px",
                  fontWeight: 700,
                  fontFamily: "var(--font-mono, monospace)",
                  padding: "2px 7px",
                  borderRadius: "12px",
                  cursor: "pointer",
                  background: "rgba(245, 158, 11, 0.15)",
                  color: "#fbbf24",
                  border: "1px solid rgba(245, 158, 11, 0.35)",
                }}
                title="Add 3D review note on selected feature or model"
              >
                + Note
              </button>

              {/* Whisker Magnification Selector */}
              {showProbes && (
                <button
                  type="button"
                  data-testid="qif-whisker-scale-btn"
                  onClick={() => {
                    setWhiskerScale((prev) => (prev === 10 ? 50 : prev === 50 ? 100 : prev === 100 ? 200 : 10));
                  }}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    fontSize: "10px",
                    fontWeight: 700,
                    fontFamily: "var(--font-mono, monospace)",
                    padding: "2px 8px",
                    borderRadius: "12px",
                    cursor: "pointer",
                    background: "rgba(56, 189, 248, 0.15)",
                    color: "#38bdf8",
                    border: "1px solid rgba(56, 189, 248, 0.35)",
                  }}
                  title="Cycle CMM probe deviation magnification (10×, 50×, 100×, 200×)"
                >
                  <span style={{ color: "#94a3b8" }}>Whiskers:</span>
                  <span>{whiskerScale}×</span>
                </button>
              )}

              {/* Out-of-Spec Inspection Tour */}
              {issueCallouts.length > 0 ? (
                <div
                  data-testid="qif-inspection-tour"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "2px",
                    background: "rgba(239, 68, 68, 0.18)",
                    border: "1px solid rgba(239, 68, 68, 0.45)",
                    borderRadius: "12px",
                    padding: "1px 6px",
                    color: "#fca5a5",
                    fontSize: "10px",
                    fontWeight: 700,
                    fontFamily: "var(--font-mono, monospace)",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => handleTourStep(-1)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#fca5a5",
                      cursor: "pointer",
                      padding: "0 2px",
                      fontWeight: 800,
                      fontSize: "9px",
                    }}
                    title="Previous non-conformance"
                    aria-label="Previous non-conformance"
                  >
                    ◀
                  </button>
                  <button
                    type="button"
                    onClick={() => handleTourStep(1)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#fca5a5",
                      cursor: "pointer",
                      padding: "1px 4px",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                      fontWeight: 700,
                      fontSize: "10px",
                    }}
                    title="Tour out-of-spec characteristics on the 3D model"
                  >
                    <span>
                      ⚠️ Tour Issues ({tourIndex + 1}/{issueCallouts.length})
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleTourStep(1)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#fca5a5",
                      cursor: "pointer",
                      padding: "0 2px",
                      fontWeight: 800,
                      fontSize: "9px",
                    }}
                    title="Next non-conformance"
                    aria-label="Next non-conformance"
                  >
                    ▶
                  </button>
                </div>
              ) : (
                <span
                  data-testid="qif-all-inspec-badge"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    fontSize: "10px",
                    fontWeight: 700,
                    fontFamily: "var(--font-mono, monospace)",
                    padding: "2px 8px",
                    borderRadius: "12px",
                    background: "rgba(34, 197, 94, 0.15)",
                    color: "#4ade80",
                    border: "1px solid rgba(34, 197, 94, 0.35)",
                  }}
                  title="All inspected characteristics are within specified tolerance zones"
                >
                  ✓ 100% In-Spec
                </span>
              )}
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
                        setFocusTrigger({
                          point: [
                            (c.surfaceAnchor[0] - sceneCenter[0]) * sceneScale,
                            (c.surfaceAnchor[1] - sceneCenter[1]) * sceneScale,
                            (c.surfaceAnchor[2] - sceneCenter[2]) * sceneScale,
                          ],
                          timestamp: Date.now(),
                        });
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
                      <td style={{ padding: "8px" }}>
                        <FeatureControlFrame
                          symbol={c.gdtSymbol}
                          isDiametrical={c.isDiametrical}
                          toleranceZone={c.toleranceZone}
                          materialCondition={c.materialCondition}
                          datumReferences={c.datumReferences}
                          status={c.status}
                          toleranceRatio={c.toleranceRatio}
                        />
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
  const validation = useMemo((): { ok: true; doc: QifDocument } | { ok: false; message: string } => {
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
      return { ok: true, doc };
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
  return <QifViewerInner {...props} parsedDoc={validation.doc} />;
};

export default QifViewer;
